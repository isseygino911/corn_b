// Example only. Start with: pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'corn_b',
      script: 'src/index.js',
      node_args: '--env-file=.env',
      env: { NODE_ENV: 'production' },
    },
  ],
};
