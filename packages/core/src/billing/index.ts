/**
 * Taking money, as domain logic.
 *
 * Lives here rather than in `apps/api` because the API is not the only caller:
 * the worker's nightly reconcile re-reads subscription state from the provider
 * too, and an app importing from another app is the wrong direction for a
 * dependency.
 *
 * What stays in the API is the part that is genuinely HTTP: the meter, which
 * turns an empty balance into a 402.
 */
export * from "./provider";
export * from "./products";
export * from "./polar";
export * from "./sync";
