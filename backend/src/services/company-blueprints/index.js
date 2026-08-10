/**
 * Company blueprint public API — JSON packs + published DB blueprints.
 */
export {
  getBlueprint,
  listCompanyTypeCards,
  listBlueprintsForIndustry,
  listIndustries,
  resolveCompanyTypeId,
  inferCompanyTypeFromText,
  policyTextForStyle,
  hasDedicatedCompanyTemplate,
  getDefaultBlueprintIdForIndustry,
  listAllBlueprintsAdmin,
  publishBlueprintFromPayload,
  unpublishBlueprint,
  setIndustryDefaultBlueprint,
  ensureCompanyBlueprintsSchema,
  invalidateBlueprintCache,
  getBlueprintForAdminExport,
  buildCompanyBlueprintExportZip,
} from './registry.js';

export {
  sanitizeBlueprintSecrets,
  cloneAndSanitizeBlueprint,
  findResidualLiveSecrets,
} from './secret-sanitize.js';

// Lazy COMPAN_TYPE_CARDS for any legacy read of the constant
import { listCompanyTypeCards } from './registry.js';
export function getCompanyTypeCards() {
  return listCompanyTypeCards();
}

// Standard platform prefabs (COO / WFB / Help + Business Core + IBKR manifests)
export {
  getStandardCatalog,
  listStandardPrefabInventory,
  getCrmAgentDefs,
  getErpAgentDefs,
  loadMakerCheckerWorkflowTemplate,
  getPlatformLeanAgents,
  getPlatformLeanAgentIds,
  getPlatformLeanAgentDefs,
  FALLBACK_PLATFORM_LEAN_AGENT_IDS,
  getIbkrWorkflowManifest,
} from './standard-prefabs.js';
