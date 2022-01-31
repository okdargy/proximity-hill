## proximity-hill

A node-hill script that integrates WebRTC voice chat with proximity volume.

## Setup

### Install all necessary packages

```
npm install
```

### Create your super secret .env file with your super secret JWT token

First, create a secure 64 character token using Node.js's built in crypto library.

```
require('crypto').randomBytes(64).toString('hex')
```

Then insert that token into your .env file just like this:

```
JWT_SECRET=super_secret_token
```
