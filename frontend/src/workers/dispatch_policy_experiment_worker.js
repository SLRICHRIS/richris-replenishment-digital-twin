// Prediction has no access to the hardware connection or command functions.
import { comparePolicies } from '../twin/paired_dispatch_policy_experiments.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ requestId: data.requestId, result: comparePolicies(data.snapshot, data.options) }); }
  catch (error) { self.postMessage({ requestId: data.requestId, error: error.message }); }
};
