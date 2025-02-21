## proximity-hill

A [node-hill](https://www.npmjs.com/package/node-hill) script that integrates PeerJS voice chat that has proximity volume.

[![View Demo](https://i.imgur.com/Vp3NUci.png)](https://www.brick-hill.com/play/30492)
[![View Demo](https://i.imgur.com/Lu3JHrI.png)](https://www.npmjs.com/package/node-hill)

> [!NOTE]
> Since this project is dead, check out the video SirStephen made on it when it first came out!
> 
> [![Brick Hill... Voice Chat](https://github.com/user-attachments/assets/ae8788b9-0c20-4cda-8c39-18c2cb468c40)](https://www.youtube.com/watch?v=QsPOLbcz-4c)

## Setup

### Install all necessary packages

```
npm install
```

### Create your super secret .env file

First, insert your server port to host proximity-hill:

```
PORT=3000
```

Now, create a secure 64 character token using Node.js's built in crypto library.

```
require('crypto').randomBytes(64).toString('hex')
```

Then insert that token into your .env file just like this:

```
JWT_SECRET=super_secret_token
PORT=3000
```

## Run your server

To start your server, type in this command:

```
npm start
```

## Thanks to:

[Meshiest/demo-voice](https://github.com/Meshiest/demo-voice)

[Meshiest/demo-proximity-voice](https://github.com/Meshiest/demo-proximity-voice)
