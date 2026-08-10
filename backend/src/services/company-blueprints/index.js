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
  getIbkrWorkflowManifest,
} from './standard-prefabs.js';