const identifier={type:'string',minLength:1,maxLength:96};
const operation={operationId:{...identifier,description:'Operation ID returned by physical_invoke; never substitute a device ID.'}};
export const physicalSchemas={
 physical_entities_list:{type:'object',properties:{},required:[],additionalProperties:false},
 physical_invoke:{type:'object',properties:{
  entityId:{...identifier,description:'Registered asset ID discovered using physical_entities_list, not a local HA entity or device name.'},
  action:{...identifier,description:'Exact declared action name from that asset description.actions.'},
  input:{type:'object',additionalProperties:true,description:'Arguments matching the discovered action input schema. Use approved friendly values; no HA YAML, package IDs or credentials.'},
  idempotencyKey:{type:'string',minLength:1,maxLength:128,description:'Unique key for a new request. Retain this exact key only when retrying the same request.'},
  timeoutMs:{type:'integer',minimum:1000,maximum:300000,description:'Approval/execution deadline, in milliseconds.'}
 },required:['entityId','action','input','idempotencyKey'],additionalProperties:false},
 physical_operation_get:{type:'object',properties:operation,required:['operationId'],additionalProperties:false},
 physical_evidence_get:{type:'object',properties:{...operation,index:{type:'integer',minimum:0,description:'Optional evidence attachment index, default 0.'}},required:['operationId'],additionalProperties:false},
 physical_cancel:{type:'object',properties:operation,required:['operationId'],additionalProperties:false}
};
