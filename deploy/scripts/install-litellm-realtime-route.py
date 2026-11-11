"""Version-checked compatibility patch for LiteLLM Realtime request-scoped routes.
Only retain model/base metadata in the encrypted session token, never the durable key.
"""
from pathlib import Path
import sys,ast
p=Path(sys.argv[1]);s=p.read_text()
marker='# FLOLAH_REALTIME_SCOPED_ROUTE_V1'
if marker in s:
 print('Realtime scoped route already installed');sys.exit(0)
def replace(old,new,count=1):
 global s
 assert s.count(old)==count, 'Installed LiteLLM Realtime ABI changed: '+old[:65]
 s=s.replace(old,new)
replace('    session_type: str = "realtime",\n) -> str:', '    session_type: str = "realtime",\n    egress_route: dict | None = None,\n) -> str:')
replace('    return json.dumps(payload, separators=(",", ":"))', '    if egress_route is not None:\n        payload["egress_route"] = egress_route\n    return json.dumps(payload, separators=(",", ":"))')
replace('        data = {"model": model}', '''        data = {"model": model}
        # FLOLAH_REALTIME_SCOPED_ROUTE_V1
        flolah_egress_route = None
        if body.get("user_config") is not None:
            if not general_settings.get("allow_client_side_credentials"):
                raise ValueError("Request-scoped Realtime routing is disabled")
            config = body["user_config"]
            entries = config.get("model_list", [])
            if len(entries) != 1 or entries[0].get("model_name") != model:
                raise ValueError("Realtime requires one matching scoped model")
            params = entries[0].get("litellm_params", {})
            if not str(params.get("model", "")).startswith("openai/") or not params.get("api_base"):
                raise ValueError("Unsupported scoped Realtime provider")
            flolah_egress_route = {k: params[k] for k in ("model", "api_base")}
            data["user_config"] = {"model_list": entries, "num_retries": 0, "max_fallbacks": 0, "fallbacks": []}''')
replace('        session_type=session_type,\n    )\n    encrypted_token:', '''        session_type=session_type,
        egress_route=flolah_egress_route,
    )
    encrypted_token:''')
needle='''        data = await add_litellm_data_to_request(
            data=data,
            request=request,
            general_settings=general_settings,
            user_api_key_dict=minimal_auth,'''
replace(needle,'''        scoped_route = decoded_payload.get("egress_route") if decoded_payload else None
        if scoped_route is not None:
            data["user_config"] = {"model_list": [{"model_name": model, "litellm_params": {
                "model": scoped_route["model"], "api_base": scoped_route["api_base"],
                "api_key": openai_ephemeral_key,
            }}], "num_retries": 0, "max_fallbacks": 0, "fallbacks": []}
        data = await add_litellm_data_to_request(
            data=data,
            request=request,
            general_settings=general_settings,
            user_api_key_dict=minimal_auth,''')
ast.parse(s);p.write_text(s);print('Realtime scoped route installed')
