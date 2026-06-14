const recommendationService = require('../services/recommendationService');

// Helper to run a test case and print results
function runTestCase(name, { claim, policy, worker }, expectedDecision, expectedCompensation, expectedReliabilityRange) {
  console.log(`\n--------------------------------------------`);
  console.log(`TEST CASE: ${name}`);
  console.log(`--------------------------------------------`);
  
  // Call evaluateClaim synchronously (or resolving promise)
  // Since our service evaluateClaim is async, we resolve it
  return recommendationService.evaluateClaim(claim, policy, worker)
    .then(result => {
      console.log(`Recommendation:  ${result.decision} (Expected: ${expectedDecision})`);
      console.log(`Reliability:     ${result.reliabilityScore}/100`);
      console.log(`Confidence:      ${result.confidenceScore}%`);
      console.log(`Suggested Payout:₹${result.suggestedCompensation} (Expected: ₹${expectedCompensation})`);
      console.log(`Decision Time:   ${result.decisionTimeMs}ms (SLA: ${result.isWithinSLA ? 'PASS' : 'FAIL'})`);
      
      console.log('\nWhy This Recommendation? Panel:');
      console.log(`  [${result.whyThisRecommendation.weatherVerified ? '✓' : ' '}] Weather Verified`);
      console.log(`  [${result.whyThisRecommendation.trafficVerified ? '✓' : ' '}] Traffic Verified`);
      console.log(`  [${result.whyThisRecommendation.pollutionVerified ? '✓' : ' '}] Pollution Verified`);
      console.log(`  [${result.whyThisRecommendation.coverageActive ? '✓' : ' '}] Coverage Active`);
      console.log(`  [${result.whyThisRecommendation.fraudRiskLow ? '✓' : ' '}] Low Fraud Probability`);
      console.log(`  [${result.whyThisRecommendation.similarClaimsApproved ? '✓' : ' '}] Similar Claims Approved`);

      console.log('\nRule Explanations:');
      result.explanation.forEach(exp => console.log(`  - ${exp}`));

      // Assertions
      let success = true;
      if (result.decision !== expectedDecision) {
        console.error(`[FAIL] Decision mismatch: got ${result.decision}, expected ${expectedDecision}`);
        success = false;
      }
      if (result.suggestedCompensation !== expectedCompensation) {
        console.error(`[FAIL] Compensation mismatch: got ₹${result.suggestedCompensation}, expected ₹${expectedCompensation}`);
        success = false;
      }
      if (result.reliabilityScore < expectedReliabilityRange[0] || result.reliabilityScore > expectedReliabilityRange[1]) {
        console.error(`[FAIL] Reliability score out of range: got ${result.reliabilityScore}, expected between ${expectedReliabilityRange[0]} and ${expectedReliabilityRange[1]}`);
        success = false;
      }

      if (success) {
        console.log(`\n[PASS] Test Case "${name}" passed successfully.`);
      } else {
        process.exitCode = 1;
      }
      return success;
    })
    .catch(err => {
      console.error(`[ERROR] Test Case "${name}" failed with exception:`, err);
      process.exitCode = 1;
      return false;
    });
}

async function runAll() {
  console.log('=== STARTING ECDE UNIT TESTS (NO DATABASE REQUIRED) ===');

  // MOCK BASE POLICY
  const mockPolicy = {
    status: { current: 'active' },
    coverage: {
      maxPayoutPerClaim: 500,
      coveredRisks: [
        {
          type: 'extreme_weather',
          isActive: true,
          thresholds: { weather: { rainfall: 15, windSpeed: 50, temperature: 45 } }
        },
        {
          type: 'traffic_congestion',
          isActive: true,
          thresholds: { traffic: { congestionLevel: 8, averageSpeed: 5 } }
        }
      ]
    }
  };

  // MOCK BASE WORKER
  const mockWorker = {
    status: { subscriptionStatus: 'active' },
    premium: { currentWeekPaid: true },
    riskProfile: {
      historicalClaims: {
        totalClaims: 5,
        approvedClaims: 4,
        rejectedClaims: 1,
        totalPayoutAmount: 1200
      }
    }
  };

  // --- CASE 1: Standard Disruption (Recommended Approval) ---
  // Weather, Rainfall 30mm/hr vs 15mm/hr. Impact Factor = 1.0 (capped). 
  // Base coverage = 250. Suggested Compensation = 250. Fraud Score = 0.12.
  const claim1 = {
    claimNumber: 'CLM-001',
    trigger: {
      type: 'extreme_weather',
      detectedValues: { weather: { rainfall: 30, windSpeed: 20, temperature: 28 } },
      thresholds: { weather: { rainfall: 15, windSpeed: 50, temperature: 45 } }
    },
    validation: { consensusScore: 1.0 },
    financial: { estimatedLoss: { totalLoss: 250 } },
    fraud: { riskScore: 0.12 }
  };

  // --- CASE 2: Below Trigger Threshold (Recommended Rejection) ---
  // Weather, Rainfall 2mm/hr vs 15mm/hr. Impact Factor = 2/15 = 0.13.
  // Should reject due to low environmental impact (< 0.15).
  const claim2 = {
    claimNumber: 'CLM-002',
    trigger: {
      type: 'extreme_weather',
      detectedValues: { weather: { rainfall: 2, windSpeed: 10, temperature: 25 } },
      thresholds: { weather: { rainfall: 15, windSpeed: 50, temperature: 45 } }
    },
    validation: { consensusScore: 0.9 },
    financial: { estimatedLoss: { totalLoss: 300 } },
    fraud: { riskScore: 0.10 }
  };

  // --- CASE 3: Suspicious Activity (Manual Review Required) ---
  // Traffic, Congestion 9/10 vs 8/10. Impact Factor = 1.0 (capped).
  // Fraud score = 0.45. Since fraud is between 0.3 and 0.7, it must trigger manual review.
  const claim3 = {
    claimNumber: 'CLM-003',
    trigger: {
      type: 'traffic_congestion',
      detectedValues: { traffic: { congestionLevel: 9, averageSpeed: 4 } },
      thresholds: { traffic: { congestionLevel: 8, averageSpeed: 5 } }
    },
    validation: { consensusScore: 0.8 },
    financial: { estimatedLoss: { totalLoss: 400 } },
    fraud: { riskScore: 0.45 }
  };

  // --- CASE 4: High Fraud Score (Recommended Rejection) ---
  // Rainfall 30mm/hr vs 15mm/hr. Fraud score = 0.75.
  // Should reject due to high fraud risk (>= 0.70).
  const claim4 = {
    claimNumber: 'CLM-004',
    trigger: {
      type: 'extreme_weather',
      detectedValues: { weather: { rainfall: 30, windSpeed: 20, temperature: 28 } },
      thresholds: { weather: { rainfall: 15, windSpeed: 50, temperature: 45 } }
    },
    validation: { consensusScore: 1.0 },
    financial: { estimatedLoss: { totalLoss: 500 } },
    fraud: { riskScore: 0.75 }
  };

  // --- CASE 5: Inactive Worker Premium (Recommended Rejection) ---
  // Worker premium unpaid. Should reject immediately.
  const mockWorkerInactive = {
    status: { subscriptionStatus: 'active' },
    premium: { currentWeekPaid: false },
    riskProfile: { historicalClaims: { totalClaims: 0 } }
  };
  const claim5 = {
    claimNumber: 'CLM-005',
    trigger: {
      type: 'extreme_weather',
      detectedValues: { weather: { rainfall: 30, windSpeed: 20, temperature: 28 } },
      thresholds: { weather: { rainfall: 15, windSpeed: 50, temperature: 45 } }
    },
    validation: { consensusScore: 1.0 },
    financial: { estimatedLoss: { totalLoss: 500 } },
    fraud: { riskScore: 0.05 }
  };

  // Run all sequentially
  await runTestCase('Happy Path (Approval & full payout)', { claim: claim1, policy: mockPolicy, worker: mockWorker }, 'recommended_approval', 250, [80, 100]);
  await runTestCase('Minor Disruption (Low Env Impact Rejection)', { claim: claim2, policy: mockPolicy, worker: mockWorker }, 'recommended_rejection', 0, [50, 80]);
  await runTestCase('Suspicious Claim (Admin Review Trigger)', { claim: claim3, policy: mockPolicy, worker: mockWorker }, 'manual_review', 400, [60, 85]);
  await runTestCase('Fraud Flagged (High Risk Rejection)', { claim: claim4, policy: mockPolicy, worker: mockWorker }, 'recommended_rejection', 500, [30, 60]);
  await runTestCase('Inactive Premium Coverage Block', { claim: claim5, policy: mockPolicy, worker: mockWorkerInactive }, 'recommended_rejection', 500, [30, 70]);

  console.log('\n=== UNIT TESTS COMPLETED ===');
}

runAll();
