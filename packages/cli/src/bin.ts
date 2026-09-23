#!/usr/bin/env node
import { runCli } from "./index.ts";

const res = await runCli(process.argv.slice(2), process.env);
if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);
process.exit(res.exitCode);
