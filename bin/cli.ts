#!/usr/bin/env node

import { createProgram } from '../src/cli/index.js';

createProgram().parseAsync(process.argv);
