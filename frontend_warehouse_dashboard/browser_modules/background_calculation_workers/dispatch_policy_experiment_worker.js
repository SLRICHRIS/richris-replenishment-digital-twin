// Prediction has no access to the hardware connection or command functions.
import { comparePolicies } from '../robot_state_models_and_policy_experiments/compare_dispatch_policies_with_shared_inputs.js';
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      requestId: data.requestId,
      result: comparePolicies(data.snapshot, data.options),
    });
  } catch (error) {
    self.postMessage({ requestId: data.requestId, error: error.message });
  }
};
