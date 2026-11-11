// These suites inject fetch; only fixture configuration is used, never provider keys.
process.env.LITELLM_BASE_URL='http://gateway-fixture:4000/v1';
process.env.LITELLM_MASTER_KEY='proxy-test-fixture';
