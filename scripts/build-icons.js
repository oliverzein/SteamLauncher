#!/usr/bin/env node
/*
  Generate PNG icons from assets/app-icon.svg for Electron.
  Requires: npm i -D sharp
*/
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const root = process.cwd()
const svgPath = path.join(root, 'assets', 'app-icon.svg')
if (!fs.existsSync(svgPath)) {
  console.error('Missing assets/app-icon.svg')
  process.exit(1)
}

const outPng = path.join(root, 'assets', 'app-icon.png')
const sizes = [512, 256, 128, 64, 48, 32, 24, 16]
const outDir = path.join(root, 'build', 'icons')
fs.mkdirSync(outDir, { recursive: true })

async function run() {
  // Primary PNG for Linux packager
  await sharp(svgPath).resize(512, 512).png().toFile(outPng)
  console.log('Wrote', path.relative(root, outPng))
  // Additional sizes if needed later
  for (const size of sizes) {
    const out = path.join(outDir, `icon-${size}x${size}.png`)
    await sharp(svgPath).resize(size, size).png().toFile(out)
    console.log('Wrote', path.relative(root, out))
  }
}

run().catch(err => { console.error(err); process.exit(1) })
