#!/usr/bin/env node
import {
  setPlatformLlmActiveEndpoint,
  getPlatformLlmStatusPublic,
} from './src/services/platform-llm-settings.js';

const r = setPlatformLlmActiveEndpoint('secondary');
console.log(JSON.stringify({ openclaw: r.openclaw, status: getPlatformLlmStatusPublic() }, null, 2));
