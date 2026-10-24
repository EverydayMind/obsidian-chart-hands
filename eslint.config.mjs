import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
    { ignores: ['node_modules/**', 'main.js'] },
    ...obsidianmd.configs.recommended,
]);
