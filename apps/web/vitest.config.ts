import { configDefaults, defineConfig } from 'vitest/config';

// The standalone build (.next/standalone) contains a copy of the sources: never collect tests from it.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, '.next/**'] } });
