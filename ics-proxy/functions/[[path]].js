import { handleRequest } from '../src/handler.js';

export const onRequest = ({ request, env }) => handleRequest(request, env);
