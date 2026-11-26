// Registered platform API contract, independent of channel or user wording.
export const voiceInviteSchema={type:'object',additionalProperties:false,properties:{
 agent_id:{type:'string',minLength:1,description:'Exact authorized AI employee ID; omit to invite the calling agent.'},
 user_id:{type:'string',minLength:1,description:'Exact human colleague ID from the company directory; COO only.'},
 user_name:{type:'string',minLength:1,description:'Exact human colleague name from the company directory; COO only.'},
 ttl_seconds:{type:'integer',minimum:60,maximum:3600,description:'Invitation lifetime in seconds; default 600.'}
}};
