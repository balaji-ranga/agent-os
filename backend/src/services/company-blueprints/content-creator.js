/** @deprecated Prefer getBlueprint('content_creator') from JSON packs. */
import { getBlueprint } from './registry.js';
const contentCreatorBlueprint = getBlueprint('content_creator');
export { contentCreatorBlueprint };
export default contentCreatorBlueprint;