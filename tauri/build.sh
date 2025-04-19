#!/bin/bash
set -e

echo "Building Tauri application..."

# Navigate to the source directory
cd /src

# Install npm dependencies
echo "Installing npm dependencies..."
npm install

# Build the application
echo "Building the application..."
cargo tauri build

# Copy the built artifacts to the dist directory
echo "Copying artifacts to dist directory..."
mkdir -p /dist
cp -r src-tauri/target/release/bundle/* /dist/

echo "Build completed successfully!"
