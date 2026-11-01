export const randomUUID=()=>NativeEdge.uuid();export const createHash=()=>{let input='';return {update(text){input+=text;return this;},digest(){return NativeEdge.sha256(input);}};};
