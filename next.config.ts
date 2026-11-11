import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  // Load the local ONNX embedding runtime from node_modules at run time
  // instead of bundling it (it ships native binaries).
  serverExternalPackages: ['@huggingface/transformers'],
};
export default nextConfig;
