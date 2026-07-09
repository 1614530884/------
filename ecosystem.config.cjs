module.exports = {
  apps: [{
    name: 'idc-order',
    script: 'node_modules/next/dist/bin/next',
    args: 'start -p 3000',
    cwd: '/www/wwwroot/juzi_idc_order',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
