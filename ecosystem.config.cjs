module.exports = {
  apps: [{
    name: 'idc-order',
    script: 'dist/server.js',
    cwd: '/www/wwwroot/juzi_idc_order',
    env: {
      NODE_ENV: 'production',
      COZE_PROJECT_ENV: 'PROD',
      PORT: 3000,
      HOSTNAME: '127.0.0.1'
    }
  }]
}
