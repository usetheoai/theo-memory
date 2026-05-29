/**
 * Barrel for src/local/reflection/ — local ReflectionPolicy implementations
 * per plan v0-4a-reflection-pipeline.
 */
export {
  ThresholdReflectionPolicy,
  type ThresholdReflectionPolicyConfig,
} from './threshold-reflection-policy.js';

export {
  SleepTimeReflectionPolicy,
  type SleepTimeReflectionPolicyConfig,
} from './sleep-time-reflection-policy.js';
