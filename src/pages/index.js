import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import styles from "@/styles/Home.module.css";

export default function Home() {
  const router = useRouter();
  // UI and flow state
  const [step, setStep] = useState("waiting");
  const [issuer, setIssuer] = useState("");
  const [launch, setLaunch] = useState("");
  const [patientData, setPatientData] = useState(null);
  const [error, setError] = useState("");

  /**
   * MAIN FLOW: useEffect runs first when the page loads or router is ready.
   * It checks the URL for SMART launch or OAuth callback parameters and
   * determines which step to run next.
   *
   * Order of execution:
   * 1. useEffect runs on page load (or router ready)
   * 2. If ?code & ?state in URL: handleOAuthCallback() is called (OAuth callback)
   * 3. Else if ?iss & ?launch in URL: discoverEndpoints() is called (SMART launch)
   * 4. discoverEndpoints() calls buildAuthUrl() (to build and redirect to auth URL)
   * 5. buildAuthUrl() redirects to Cerner (user logs in)
   * 6. After login, Cerner redirects back with ?code & ?state, so useEffect runs again and calls handleOAuthCallback()
   * 7. handleOAuthCallback() exchanges code for token, then calls fetchPatientData()
   * 8. fetchPatientData() fetches and displays patient demographics
   */
  useEffect(() => {
    if (!router.isReady) return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const currentIssuer = params.get("iss");
    const currentLaunch = params.get("launch");

    // Debug: Log all URL params and sessionStorage
    console.log("--- useEffect RUN ---");
    console.log("URL:", window.location.href);
    console.log("URL params:", { code, state, currentIssuer, currentLaunch });
    console.log("sessionStorage:", {
      code_verifier: sessionStorage.getItem('code_verifier'),
      iss: sessionStorage.getItem('iss'),
      issuer: sessionStorage.getItem('issuer'),
      launch: sessionStorage.getItem('launch'),
      state: sessionStorage.getItem('state'),
      token_endpoint: sessionStorage.getItem('token_endpoint'),
    });

    // Step 1: Check if this is an OAuth callback (after Cerner login)
    if (code && state) {
      console.log("Detected OAuth callback (code & state in URL)");
      handleOAuthCallback(code, state);
      return; // <--- This prevents the rest of the logic from running
    }

    // Step 2: Check if this is a SMART launch (from EHR)
    if (currentIssuer && currentLaunch) {
      console.log("Detected SMART launch (iss & launch in URL)");
      setIssuer(currentIssuer);
      setLaunch(currentLaunch);
      setStep("launch");
      discoverEndpoints(currentIssuer, currentLaunch);
    } else {
      console.log("Missing required parameters. Triggering error state.");
      setError("Missing required parameters. Please launch from EHR.");
      setStep("error");
    }
  }, [router.isReady]);

  /**
   * Step 2: Discover SMART endpoints from the FHIR server's well-known URL.
   * Calls buildAuthUrl() to continue the flow.
   * @param {string} issuerUrl - The FHIR server base URL
   */
  const discoverEndpoints = async (issuerUrl, launch) => {
    try {
      setStep("discovering");
      const wellKnownUrl = `${issuerUrl}/.well-known/smart-configuration`;
      const response = await fetch(wellKnownUrl);
      if (!response.ok) {
        throw new Error(`Failed to discover endpoints: ${response.status}`);
      }
      const config = await response.json();
      // Continue to build the authorization URL
      buildAuthUrl(issuerUrl, config, launch);
    } catch (error) {
      setError(`Discovery failed: ${error.message}`);
      setStep("error");
    }
  };

  /**
   * Step 3: Build the SMART on FHIR authorization URL and redirect the user to Cerner's login/consent page.
   * This function is called by discoverEndpoints().
   * @param {string} issuerUrl - The FHIR server base URL
   * @param {object} config - The SMART configuration (endpoints)
   */
  const buildAuthUrl = async (issuerUrl, config, launch) => {
    try {
      setStep("building-auth");
      const clientId = process.env.NEXT_PUBLIC_CERNER_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_CERNER_REDIRECT_URI;
      if (!clientId || !redirectUri) {
        throw new Error("Missing environment variables");
      }
      // PKCE: generate code verifier and challenge
      const codeVerifier = generateRandomString(128);
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = generateRandomString(32);
      // Store values for use after redirect
      sessionStorage.setItem('code_verifier', codeVerifier);
      sessionStorage.setItem('state', state);
      sessionStorage.setItem('issuer', issuerUrl);
      sessionStorage.setItem('token_endpoint', config.token_endpoint);
      // Store iss and launch for callback
      sessionStorage.setItem('iss', issuerUrl);
      sessionStorage.setItem('launch', launch);
      // Build the authorization URL
      const authParams = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'openid profile user/Patient.read user/Observation.read fhirUser',
        state: state,
        aud: issuerUrl,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });
      const authUrl = `${config.authorization_endpoint}?${authParams.toString()}`;
      setStep("redirecting");
      // Redirect to Cerner for login/consent
      window.location.href = authUrl;
    } catch (error) {
      setError(`Auth URL build failed: ${error.message}`);
      setStep("error");
    }
  };

  /**
   * Step 4: Handle the OAuth callback from Cerner (after user logs in and consents).
   * Exchanges the authorization code for an access token, then calls fetchPatientData().
   * @param {string} code - The authorization code from Cerner
   * @param {string} state - The state parameter for CSRF protection
   */
  const handleOAuthCallback = async (code, state) => {
    try {
      setStep("exchanging-token");
      // Debug: Log sessionStorage at callback
      console.log("--- handleOAuthCallback RUN ---");
      console.log("code:", code, "state:", state);
      console.log("sessionStorage at callback:", {
        code_verifier: sessionStorage.getItem('code_verifier'),
        iss: sessionStorage.getItem('iss'),
        issuer: sessionStorage.getItem('issuer'),
        launch: sessionStorage.getItem('launch'),
        state: sessionStorage.getItem('state'),
        token_endpoint: sessionStorage.getItem('token_endpoint'),
      });
      const storedState = sessionStorage.getItem('state');
      const codeVerifier = sessionStorage.getItem('code_verifier');
      const tokenEndpoint = sessionStorage.getItem('token_endpoint');
      // Retrieve iss and launch from sessionStorage
      const issuer = sessionStorage.getItem('iss');
      const launch = sessionStorage.getItem('launch');
      setIssuer(issuer);
      setLaunch(launch);
      if (state !== storedState) {
        console.log("State mismatch!", { state, storedState });
        throw new Error("State mismatch");
      }
      // Exchange code for token
      const tokenResponse = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: process.env.NEXT_PUBLIC_CERNER_REDIRECT_URI,
          client_id: process.env.NEXT_PUBLIC_CERNER_CLIENT_ID,
          code_verifier: codeVerifier,
        }),
      });
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.log("Token exchange failed:", errorText);
        throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
      }
      const tokenData = await tokenResponse.json();
      console.log("Token exchange success:", tokenData);
      // Do NOT fetch patient data, just set success step
      setStep("success");
    } catch (error) {
      console.log("Error in handleOAuthCallback:", error);
      setError(`Token exchange failed: ${error.message}`);
      setStep("error");
    }
  };

  /**
   * Step 5: Fetch patient demographics from the FHIR server using the access token.
   * This is called after a successful token exchange.
   * @param {string} accessToken - The OAuth access token
   * @param {string} patientId - The FHIR Patient resource ID
   */
  const fetchPatientData = async (accessToken, patientId) => {
    try {
      setStep("fetching-patient");
      const issuer = sessionStorage.getItem('issuer');
      const patientUrl = `${issuer}/Patient/${patientId}`;
      const response = await fetch(patientUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/fhir+json',
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch patient: ${response.status}`);
      }
      const patient = await response.json();
      setPatientData(patient);
      setStep("success");
    } catch (error) {
      setError(`Patient fetch failed: ${error.message}`);
      setStep("error");
    }
  };

  /**
   * Helper: Generate a random string for PKCE and state
   */
  const generateRandomString = (length) => {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let text = '';
    for (let i = 0; i < length; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  };

  /**
   * Helper: Generate a PKCE code challenge from a code verifier
   */
  const generateCodeChallenge = async (codeVerifier) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  /**
   * Helper: Reset the session and reload the app
   */
  const resetSession = () => {
    sessionStorage.clear();
    setStep("waiting");
    setError("");
    setPatientData(null);
    window.location.href = window.location.origin;
  };

  // --- UI rendering below ---

  // Error state
  if (step === "error") {
    return (
      <div className={styles.container}>
        <h1>Error</h1>
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={resetSession}>Reset & Try Again</button>
        </div>
      </div>
    );
  }

  // Success state: show patient demographics or login success
  if (step === "success" && !patientData) {
    return (
      <div className={styles.container}>
        <h1>Login Successful!</h1>
        <p>You have authenticated with Cerner SMART on FHIR.</p>
        <button onClick={resetSession} style={{ marginTop: '20px' }}>Start Over</button>
      </div>
    );
  }

  // Default: show current step and status
  return (
    <div className={styles.container}>
      <h1>FHIR EHR App</h1>
      <div className={styles.status}>
        <p><strong>Step:</strong> {step}</p>
        {issuer && <p><strong>Issuer:</strong> {issuer}</p>}
        {launch && <p><strong>Launch:</strong> {launch}</p>}
        {step === "discovering" && <p>Discovering SMART endpoints...</p>}
        {step === "building-auth" && <p>Building authorization URL...</p>}
        {step === "redirecting" && <p>Redirecting to authorization server...</p>}
        {step === "exchanging-token" && <p>Exchanging authorization code...</p>}
        {step === "fetching-patient" && <p>Fetching patient data...</p>}
      </div>
    </div>
  );
}
