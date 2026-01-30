Findings 27.01.26

- config/database.js
    - 2 connection string
        - adm_mut:a2ska.39dnhas28ads.
        - dev_user:dev_pass_123

- config/redis.js
    - 1 connection string
        - adm:chcsys4:

- src/utils/email.js
    - 1 Sendgrid api key
        - SG.dKls8whw0ms2910-as28hdnj20asnı3

- src/utils/s3.js
    - AWS Secret access key
        - wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY123

- tests/integration.test.js
    - 1 connection string
        - sth3wada021
    - 1 password
        - 20226mr3

- docker-compose.yml
    - 4 passwords
        - admadmadm3 (x2)
        - Il02X}O8:d/* (x2)
    - 1 JWT Secret Key
        - eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCdas2Ikjas2k

- ai-logs/chat_export.json
    - 1 basic auth credential
        - YWRtMjAyNjpQYXNzVGhlR2F0ZV8yNg==
    - 1 openai api key
        - sk-proj-B3w8kLmN3pQ7tXsaa28dhuSA028rS9tU1vW-dasjh37jSADAnd3n7al-as83dnkmla27JDKsy3hd49a-snıhf8NKLD4km4p94fn4hf743fn4unfn7e3UHS7D82jasa
    - 1 anthropic api key
        - sk-ant-api03-xYDASD8udwqnj2309dKKAD93e1e3d3zAbC123dEfGhI456jKlMnO789pQrStUvWxYzAbC12-3dEfGhI456jKlMnO789pQrStUvda92dasdy3728dh33exYzAbC
    - 1 sentry dsn (fp)
        - https://493JASPMD3882i0j@o123456.ingest.sentry....
    - 1 sentry auth token
        - sntrys_eyJpYXQiOjE3MDUyMzE4MjAsImlkIjoiNzg5MDEyMyIsImtleSI6ImU0ZjVhNmI3YzhkOWUwZjFhMmIzYzRkNWU2ZjdhOGI5In0=



Possible FP will be filled in next commit:
- src/middleware/auth.js
    - 1 JWT secret key
        - empty for now will be added in next commit

- src/utils/app.js
    - has email address but no secret

.env:
    - Possible FPs: Publishable stripe key, placeholder in redis key. 
    - secret: P8HdE28aN9xyz789abc456def

- templates/template.html
    - Google analytics ID (fp)
    - Google Maps API key (fp)
    - Stripe publishable key (fp)

- telecom-config/telconf.json
    - 2 vless connection
    - 1 APN credential
    - 1 MMS credential