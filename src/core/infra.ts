import { analyzeCompose, isComposePath } from './compose';
import type { DocumentChange, Evidence } from './evidence';
import { analyzeKubernetes, looksLikeKubernetes } from './kubernetes';
import { analyzeTerraform, isTerraformPath, looksLikeTerraformPlan } from './terraform';

/**
 * Infrastructure analyzers (Docker Compose, Kubernetes, Terraform).
 * They are pure functions over file text: no process is spawned, no network or cloud
 * API is contacted, no state is read, and secret values never reach the evidence.
 */
export const analyzeInfra = (changes: readonly DocumentChange[]): Evidence[] => [
  ...analyzeCompose(changes),
  ...analyzeKubernetes(changes),
  ...analyzeTerraform(changes),
];

/** True when at least one side of the change is a file the infrastructure analyzers interpret. */
export function isInfraDocument({ path, before, after }: DocumentChange): boolean {
  if (isComposePath(path) || isTerraformPath(path)) return true;
  const texts = [before, after].filter((text): text is string => text !== undefined);
  if (/\.ya?ml$/i.test(path)) return texts.some(looksLikeKubernetes);
  return /\.json$/i.test(path) && texts.some(looksLikeTerraformPlan);
}
