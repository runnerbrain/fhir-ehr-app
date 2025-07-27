import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import styles from "@/styles/Home.module.css";

export default function Vitals() {
  const router = useRouter();
  const [vitalsData, setVitalsData] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categoryVitals, setCategoryVitals] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [patientData, setPatientData] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVital, setNewVital] = useState({
    category: '',
    value: '',
    unit: '',
    date: new Date().toLocaleString('sv-SE').slice(0, 16) // Default to current local date/time
  });
  const [submitting, setSubmitting] = useState(false);
  const [showDebugButtons, setShowDebugButtons] = useState(false); // Toggle for debug buttons

  const VITALS_PER_PAGE = 5;

  useEffect(() => {
    // Get stored data
    const accessToken = sessionStorage.getItem('access_token');
    const patientId = sessionStorage.getItem('patient_id');
    const issuer = sessionStorage.getItem('issuer');
    const storedPatientData = sessionStorage.getItem('patient_data');

    if (!accessToken || !patientId || !issuer) {
      setError("No patient session found. Please launch from EHR.");
      setLoading(false);
      return;
    }

    if (storedPatientData) {
      setPatientData(JSON.parse(storedPatientData));
    }

    // Fetch all vitals
    fetchAllVitals(accessToken, patientId, issuer);
  }, []);

  // Helper function to log vital structure for debugging
  const logVitalStructure = (observation) => {
    console.log("=== VITAL STRUCTURE DEBUG ===");
    console.log("Full observation:", JSON.stringify(observation, null, 2));
    console.log("Has valueQuantity:", !!observation.valueQuantity);
    console.log("Has component:", !!observation.component);
    console.log("Component length:", observation.component?.length || 0);
    if (observation.component) {
      observation.component.forEach((comp, index) => {
        console.log(`Component ${index}:`, JSON.stringify(comp, null, 2));
      });
    }
    console.log("=== END DEBUG ===");
  };

  const fetchAllVitals = async (accessToken, patientId, issuer) => {
    try {
      setLoading(true);
      const vitalsUrl = `${issuer}/Observation?patient=${patientId}&category=vital-signs&_count=100&_sort=-date`;
      const response = await fetch(vitalsUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/fhir+json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch vitals: ${response.status}`);
      }
      
      const bundle = await response.json();
      console.log("All vitals data:", bundle);
      setVitalsData(bundle);
      setLoading(false);
    } catch (error) {
      console.error("Vitals fetch failed:", error);
      setError(`Vitals fetch failed: ${error.message}`);
      setLoading(false);
    }
  };

  // Group vitals by category
  const getVitalCategories = () => {
    if (!vitalsData?.entry) return [];
    
    const categories = {};
    vitalsData.entry.forEach(entry => {
      const observation = entry.resource;
      const code = observation.code?.coding?.[0];
      const category = code?.display || code?.code || 'Unknown';
      
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(observation);
    });
    
    return Object.entries(categories).map(([name, vitals]) => ({
      name,
      count: vitals.length,
      vitals: vitals.sort((a, b) => new Date(b.effectiveDateTime || b.issued) - new Date(a.effectiveDateTime || a.issued))
    }));
  };

  const selectCategory = (category) => {
    setSelectedCategory(category);
    setCurrentPage(0);
    setCategoryVitals(category.vitals.slice(0, VITALS_PER_PAGE));
  };

  const loadMoreVitals = () => {
    if (!selectedCategory) return;
    
    const nextPage = currentPage + 1;
    const startIndex = nextPage * VITALS_PER_PAGE;
    const endIndex = startIndex + VITALS_PER_PAGE;
    const newVitals = selectedCategory.vitals.slice(startIndex, endIndex);
    
    if (newVitals.length > 0) {
      setCategoryVitals(newVitals); // Replace instead of add
      setCurrentPage(nextPage);
    }
  };

  const hasMoreVitals = () => {
    if (!selectedCategory) return false;
    return (currentPage + 1) * VITALS_PER_PAGE < selectedCategory.vitals.length;
  };

  const getCurrentPageInfo = () => {
    if (!selectedCategory) return '';
    const total = selectedCategory.vitals.length;
    const start = currentPage * VITALS_PER_PAGE + 1;
    const end = Math.min((currentPage + 1) * VITALS_PER_PAGE, total);
    return `Showing ${start}-${end} of ${total}`;
  };

  const formatVitalValue = (observation) => {
    // Handle valueQuantity (simple vital like temperature, heart rate)
    const value = observation.valueQuantity;
    if (value && value.value !== undefined) {
      return `${value.value} ${value.unit || ''}`;
    }
    
    // Handle component values (complex vitals like blood pressure)
    const component = observation.component?.[0];
    if (component && component.valueQuantity && component.valueQuantity.value !== undefined) {
      const compValue = component.valueQuantity;
      return `${compValue.value} ${compValue.unit || ''}`;
    }
    
    // Handle multiple components (like blood pressure with systolic/diastolic)
    if (observation.component && observation.component.length > 1) {
      const components = observation.component.map(comp => {
        if (comp.valueQuantity && comp.valueQuantity.value !== undefined) {
          return `${comp.valueQuantity.value} ${comp.valueQuantity.unit || ''}`;
        }
        return 'N/A';
      }).filter(val => val !== 'N/A');
      
      if (components.length > 0) {
        return components.join(' / ');
      }
    }
    
    // Handle valueCodeableConcept (coded values)
    if (observation.valueCodeableConcept) {
      return observation.valueCodeableConcept.text || observation.valueCodeableConcept.coding?.[0]?.display || 'Coded value';
    }
    
    // Handle valueString
    if (observation.valueString) {
      return observation.valueString;
    }
    
    // Handle valueBoolean
    if (observation.valueBoolean !== undefined) {
      return observation.valueBoolean ? 'Yes' : 'No';
    }
    
    return 'No value available';
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    return new Date(dateString).toLocaleString();
  };

  const goBack = () => {
    // Check if we have patient data in sessionStorage
    const patientData = sessionStorage.getItem('patient_data');
    if (patientData) {
      // We have patient data, so we can safely go back to demographics
      router.push('/');
    } else {
      // No patient data, redirect to root and let it handle the error
      router.push('/');
    }
  };

  // Helper function to refresh access token
  const refreshAccessToken = async () => {
    try {
      const refreshToken = sessionStorage.getItem('refresh_token');
      const tokenEndpoint = sessionStorage.getItem('token_endpoint');
      
      if (!refreshToken || !tokenEndpoint) {
        throw new Error("No refresh token available");
      }

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: process.env.NEXT_PUBLIC_CERNER_CLIENT_ID,
        }),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const tokenData = await response.json();
      sessionStorage.setItem('access_token', tokenData.access_token);
      
      if (tokenData.refresh_token) {
        sessionStorage.setItem('refresh_token', tokenData.refresh_token);
      }

      console.log('Access token refreshed successfully');
      return tokenData.access_token;
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw error;
    }
  };

  const createNewVital = async () => {
    try {
      setSubmitting(true);
      const accessToken = sessionStorage.getItem('access_token');
      const patientId = sessionStorage.getItem('patient_id');
      const issuer = sessionStorage.getItem('issuer');

      if (!accessToken || !patientId || !issuer) {
        throw new Error("Missing authentication data");
      }

      // Create FHIR Observation resource - minimal structure based on Oracle docs
      const observation = {
        resourceType: "Observation",
        status: "final",
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "vital-signs",
                display: "Vital Signs"
              }
            ],
            text: "Vital Signs"
          }
        ],
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: getLoincCode(newVital.category)
            }
          ],
          text: newVital.category
        },
        subject: {
          reference: `Patient/${patientId}`
        },
        effectiveDateTime: new Date(newVital.date).toISOString()
      };

      // Add valueQuantity for simple vitals (like Temperature example in Oracle docs)
      observation.valueQuantity = {
        value: parseFloat(newVital.value),
        unit: newVital.unit,
        system: "http://unitsofmeasure.org",
        code: getUcumCode(newVital.unit)
      };

      console.log("Creating new observation:", observation);
      console.log("JSON payload:", JSON.stringify(observation, null, 2));

      const response = await fetch(`${issuer}/Observation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/fhir+json',
          'Accept': 'application/fhir+json'
        },
        body: JSON.stringify(observation)
      });

      console.log("Response status:", response.status);
      console.log("Response headers:", Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.log("Error response body:", errorText);
        
        // If token expired, try to refresh it and retry
        if (response.status === 401) {
          try {
            console.log("Token expired, attempting to refresh...");
            const newAccessToken = await refreshAccessToken();
            
            // Retry the request with the new token
            const retryResponse = await fetch(`${issuer}/Observation`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${newAccessToken}`,
                'Content-Type': 'application/fhir+json',
                'Accept': 'application/fhir+json'
              },
              body: JSON.stringify(observation)
            });
            
            if (!retryResponse.ok) {
              const retryErrorText = await retryResponse.text();
              throw new Error(`Failed to create vital after token refresh: ${retryResponse.status} ${retryErrorText}`);
            }
            
            // Continue with the retry response
            const responseText = await retryResponse.text();
            console.log("Retry response status:", retryResponse.status);
            console.log("Retry response body:", responseText);
            
            let createdObservation = null;
            if (responseText.trim()) {
              createdObservation = JSON.parse(responseText);
              console.log("Created observation:", createdObservation);
            } else {
              console.log("Empty response body - this is normal for successful POST operations");
            }
            
            // Reset form and refresh vitals
            setNewVital({
              category: '',
              value: '',
              unit: '',
              date: new Date().toLocaleString('sv-SE').slice(0, 16)
            });
            setShowAddForm(false);
            setSubmitting(false);
            
            // Refresh vitals data
            await fetchAllVitals(newAccessToken, patientId, issuer);
            return;
            
          } catch (refreshError) {
            throw new Error(`Token refresh failed: ${refreshError.message}`);
          }
        }
        
        throw new Error(`Failed to create vital: ${response.status} ${errorText}`);
      }

      // Check if response has content before parsing JSON
      const responseText = await response.text();
      console.log("Response status:", response.status);
      console.log("Response body:", responseText);
      
      let createdObservation = null;
      if (responseText.trim()) {
        // Only parse JSON if there's actual content
        createdObservation = JSON.parse(responseText);
        console.log("Created observation:", createdObservation);
      } else {
        console.log("Empty response body - this is normal for successful POST operations");
      }

      // Reset form and refresh vitals
      setNewVital({
        category: '',
        value: '',
        unit: '',
        date: new Date().toLocaleString('sv-SE').slice(0, 16) // Reset to current local date/time
      });
      setShowAddForm(false);
      setSubmitting(false);

      // Refresh vitals data
      await fetchAllVitals(accessToken, patientId, issuer);

    } catch (error) {
      console.error("Error creating vital:", error);
      setError(`Failed to create vital: ${error.message}`);
      setSubmitting(false);
    }
  };

  // Helper function to get LOINC codes for common vital signs
  const getLoincCode = (category) => {
    const loincCodes = {
      'Blood Pressure': '8480-6', // Blood pressure panel with all children optional
      'Temperature': '8331-1',     // Oral temperature (from Oracle docs)
      'Heart Rate': '8867-4',      // Heart rate (alternative from debug output)
      'Respiratory Rate': '9279-1', // Respiratory rate
      'Oxygen Saturation': '703498', // SpO2 (from Oracle docs)
      'Weight': '29463-7',         // Weight Measured
      'Height': '8302-2',          // Body height
      'Body Mass Index': '39156-5' // BMI Measured
    };
    return loincCodes[category] || 'unknown';
  };

  // Helper function to get UCUM codes for units
  const getUcumCode = (unit) => {
    const ucumCodes = {
      'mmHg': 'mm[Hg]',
      'bpm': '/min',
      '°C': 'Cel',
      '°F': '[degF]',
      'kg': 'kg',
      'lbs': '[lb_av]',
      'cm': 'cm',
      'in': '[in_i]',
      '%': '%'
    };
    return ucumCodes[unit] || unit;
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <h1>Loading Vitals...</h1>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <h1>Error</h1>
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={goBack}>Go Back</button>
        </div>
      </div>
    );
  }

  const categories = getVitalCategories();

  return (
    <div className={styles.container}>
      <h1>Patient Vitals</h1>
      
      {patientData && (
        <div className={styles.patientInfo} style={{ marginBottom: '20px' }}>
          <h2>Patient: {patientData.name?.[0]?.given?.join(' ')} {patientData.name?.[0]?.family}</h2>
        </div>
      )}

      {categories.length === 0 ? (
        <div className={styles.patientInfo}>
          <h2>No Vitals Found</h2>
          <p>No vital signs found for this patient.</p>
          <button onClick={goBack}>Go Back</button>
        </div>
      ) : (
        <>
          {/* Add New Vital Button */}
          <div className={styles.patientInfo} style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Vital Categories</h2>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setShowDebugButtons(!showDebugButtons)}
                  style={{
                    background: showDebugButtons ? '#ff9800' : '#ccc',
                    color: 'white',
                    border: 'none',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                  title="Toggle debug mode"
                >
                  {showDebugButtons ? '🔍 Debug ON' : '🔍 Debug OFF'}
                </button>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  style={{
                    background: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  {showAddForm ? 'Cancel' : 'Add New Vital'}
                </button>
              </div>
            </div>
            
            {/* Add New Vital Form */}
            {showAddForm && (
              <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9' }}>
                <h3>Add New Vital Sign</h3>
                <div style={{ display: 'grid', gap: '15px', marginTop: '15px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Category:</label>
                    <select
                      value={newVital.category}
                      onChange={(e) => setNewVital({...newVital, category: e.target.value})}
                      style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                    >
                      <option value="">Select a category</option>
                      <option value="Blood Pressure">Blood Pressure</option>
                      <option value="Temperature">Temperature</option>
                      <option value="Heart Rate">Heart Rate</option>
                      <option value="Respiratory Rate">Respiratory Rate</option>
                      <option value="Oxygen Saturation">Oxygen Saturation</option>
                      <option value="Weight">Weight</option>
                      <option value="Height">Height</option>
                    </select>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Value:</label>
                      <input
                        type="number"
                        step="0.1"
                        value={newVital.value}
                        onChange={(e) => setNewVital({...newVital, value: e.target.value})}
                        placeholder="Enter value"
                        style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Unit:</label>
                      <select
                        value={newVital.unit}
                        onChange={(e) => setNewVital({...newVital, unit: e.target.value})}
                        style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                      >
                        <option value="">Select unit</option>
                        <option value="mmHg">mmHg</option>
                        <option value="bpm">bpm</option>
                        <option value="°C">°C</option>
                        <option value="°F">°F</option>
                        <option value="kg">kg</option>
                        <option value="lbs">lbs</option>
                        <option value="cm">cm</option>
                        <option value="in">in</option>
                        <option value="%">%</option>
                      </select>
                    </div>
                  </div>
                  
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Date/Time:</label>
                    <input
                      type="datetime-local"
                      value={newVital.date}
                      onChange={(e) => setNewVital({...newVital, date: e.target.value})}
                      style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                    />
                  </div>
                  
                  <button
                    onClick={createNewVital}
                    disabled={submitting || !newVital.category || !newVital.value || !newVital.unit}
                    style={{
                      background: submitting ? '#ccc' : '#2196f3',
                      color: 'white',
                      border: 'none',
                      padding: '10px 20px',
                      borderRadius: '4px',
                      cursor: submitting ? 'not-allowed' : 'pointer',
                      width: '100%'
                    }}
                  >
                    {submitting ? 'Creating...' : 'Create Vital Sign'}
                  </button>
                </div>
              </div>
            )}
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px', marginTop: '20px' }}>
              {categories.map((category, index) => (
                <div key={index} style={{ display: 'flex', gap: '5px' }}>
                  <button
                    onClick={() => selectCategory(category)}
                    style={{
                      background: selectedCategory?.name === category.name ? '#2196f3' : '#f0f0f0',
                      color: selectedCategory?.name === category.name ? 'white' : 'black',
                      border: 'none',
                      padding: '10px 20px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    {category.name} ({category.count})
                  </button>
                  {showDebugButtons && (
                    <button
                      onClick={() => {
                        if (category.vitals && category.vitals.length > 0) {
                          logVitalStructure(category.vitals[0]);
                        }
                      }}
                      style={{
                        background: '#ff9800',
                        color: 'white',
                        border: 'none',
                        padding: '10px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                      title="Debug structure"
                    >
                      🔍
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Selected Category Vitals */}
          {selectedCategory && (
            <div className={styles.patientInfo}>
              <h2>{selectedCategory.name}</h2>
              <div style={{ marginBottom: '10px', fontSize: '0.9em', color: '#666' }}>
                {getCurrentPageInfo()}
              </div>
              <div className={styles.info}>
                {categoryVitals.map((vital, index) => (
                  <div key={index} style={{ borderBottom: '1px solid #eee', padding: '10px 0' }}>
                    <div><strong>Value:</strong> {formatVitalValue(vital)}</div>
                    <div style={{ fontSize: '0.9em', color: '#666' }}>
                      Date: {formatDate(vital.effectiveDateTime || vital.issued)}
                    </div>
                  </div>
                ))}
              </div>
              
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                {currentPage > 0 && (
                  <button
                    onClick={() => {
                      const prevPage = currentPage - 1;
                      const startIndex = prevPage * VITALS_PER_PAGE;
                      const endIndex = startIndex + VITALS_PER_PAGE;
                      const prevVitals = selectedCategory.vitals.slice(startIndex, endIndex);
                      setCategoryVitals(prevVitals);
                      setCurrentPage(prevPage);
                    }}
                    style={{
                      background: '#666',
                      color: 'white',
                      border: 'none',
                      padding: '10px 20px',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Previous 5
                  </button>
                )}
                
                {hasMoreVitals() && (
                  <button
                    onClick={loadMoreVitals}
                    style={{
                      background: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      padding: '10px 20px',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Load next 5
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <button onClick={goBack} style={{ marginTop: '20px' }}>Back to Demographics</button>
    </div>
  );
} 