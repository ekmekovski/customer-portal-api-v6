require('dotenv').config();

module.exports = {
  production: {
    url: 'postgres://adm_mut:a2ska.39dnhas28ads.@postgres.internal.mutevazipeynircilik.com:5432/customers',
    dialect: 'postgres',
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  },
  development: {
    url: 'postgres://dev_user:dev_pass_123@preprod.internal.mutevazipeynircilik:5432/muto',
    dialect: 'postgres'
  }
};