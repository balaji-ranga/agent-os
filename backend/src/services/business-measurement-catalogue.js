import { readFileSync } from 'node:fs';

const catalogueUrl = new URL('../config/measurement-object-catalogue.json', import.meta.url);
const catalogue = JSON.parse(readFileSync(catalogueUrl, 'utf8'));

function validateCatalogue(input) {
  if (!input || !Number.isInteger(input.version) || !input.sources || typeof input.sources !== 'object') {
    throw new Error('Invalid measurement object catalogue header');
  }
  const objectIds = new Set();
  for (const [sourceId, objects] of Object.entries(input.sources)) {
    if (!Array.isArray(objects) || !objects.length) throw new Error(`Measurement source ${sourceId} has no objects`);
    for (const object of objects) {
      if (!object.id || objectIds.has(object.id)) throw new Error(`Duplicate or missing measurement object id: ${object.id || sourceId}`);
      objectIds.add(object.id);
      if (!Array.isArray(object.fields) || !object.fields.length) throw new Error(`Measurement object ${object.id} has no fields`);
      const fieldIds = new Set();
      for (const field of object.fields) {
        if (!field.id || !field.path || !field.data_type) throw new Error(`Invalid measurement field in ${object.id}`);
        if (fieldIds.has(field.id)) throw new Error(`Duplicate measurement field ${field.id} in ${object.id}`);
        fieldIds.add(field.id);
      }
    }
  }
  return input;
}

export const MEASUREMENT_OBJECT_CATALOGUE = validateCatalogue(catalogue);
export const CRM_MEASUREMENT_OBJECTS = catalogue.sources.flolah_crm;
export const ERP_MEASUREMENT_OBJECTS = catalogue.sources.flolah_erp;

export function measurementObjectsForSource(sourceId) {
  return catalogue.sources[sourceId] || [];
}

export function toMeasurementRegistryObjects(objects, attributeFactory) {
  return (objects || []).map((entry) => ({
    id: entry.id,
    label: entry.label,
    provider_object: entry.provider_object,
    attributes: entry.fields.map((item) => ({ ...attributeFactory(
      item.id,
      item.label,
      item.data_type,
      item.description,
      entry.id,
      item.path,
    ), ...(Number.isFinite(item.scale) ? { scale: item.scale } : {}) })),
  }));
}
