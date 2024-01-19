import path from 'path';

import { viteBundler } from '@payloadcms/bundler-vite';
import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { payloadCloud } from '@payloadcms/plugin-cloud';
import { slateEditor } from '@payloadcms/richtext-slate';
import { buildConfig } from 'payload/config';

import Users from './collections/Users';

export default buildConfig({
  admin: {
    user: Users.slug,
    bundler: viteBundler(),
  },
  editor: slateEditor({}),
  collections: [Users],
  typescript: {
    outputFile: path.resolve(__dirname, 'payload-types.ts'),
  },
  graphQL: {
    schemaOutputFile: path.resolve(__dirname, 'generated-schema.graphql'),
  },
  plugins: [payloadCloud()],
  db: mongooseAdapter({
    url: process.env.DATABASE_URL,
  }),
});
