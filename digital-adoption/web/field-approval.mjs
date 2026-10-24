// This preference is set only by the visitor UI, never by model output.
export const mayApplyFieldsAutomatically=({approvalRequired=true,actions=[],mode='assist'}={})=>approvalRequired===false&&mode==='assist'&&actions.length>0&&actions.every(action=>action.type==='fill');
