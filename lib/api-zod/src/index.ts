export * from "./generated/api";
// Not re-exporting "./generated/types": those are plain-TS mirrors of the
// same schemas already exported as zod objects above (with runtime
// validation), and application code only ever imports the zod versions. Two
// endpoints sharing both path and query params (e.g. getPlayer) can cause
// orval to emit a same-named type here that collides with the zod export.
