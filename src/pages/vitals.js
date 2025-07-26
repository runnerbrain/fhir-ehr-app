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
    router.push('/');
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
          {/* Category Buttons */}
          <div className={styles.patientInfo}>
            <h2>Vital Categories</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
              {categories.map((category, index) => (
                <button
                  key={index}
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