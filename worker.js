import { handleRequest } from './src/handler.js';

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
