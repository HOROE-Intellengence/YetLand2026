#!/bin/bash
set -e
cd /usr/src/app
export CONFIG=/opt/config/config.json
if [ ! -f package.json ]; then cp install/package.json package.json; fi
if [ ! -f /opt/config/config.json ]; then
  ./nodebb setup --config=/opt/config/config.json
fi
node /prototype/configure-nodebb.cjs
if [ ! -f /opt/config/yelan-built-v2 ]; then
  ./nodebb build --config=/opt/config/config.json
  touch /opt/config/yelan-built-v2
fi
exec node loader.js --no-daemon --config=/opt/config/config.json
