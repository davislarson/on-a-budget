export type ActionState = {
  error?: string;
  // Submitted values, echoed back on failure so the form can refill itself.
  values?: Record<string, string>;
  // Shown after a successful submit, e.g. how many rows were changed.
  message?: string;
};

export const initialActionState: ActionState = {};
