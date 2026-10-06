export type ActionState = {
  error?: string;
  // Submitted values, echoed back on failure so the form can refill itself.
  values?: Record<string, string>;
};

export const initialActionState: ActionState = {};
