// Firebase web-app settings for DBWOW (Firebase console > Project settings >
// Your apps > Web app). These values are not secrets: every Firebase web app
// ships them to the browser. Access is controlled by firestore.rules.
// Leave as null to run DBWOW without accounts (everything stays in the browser).
import type { FirebaseConfig } from './firebase';

export const FIREBASE_CONFIG: FirebaseConfig | null = {
  apiKey: 'AIzaSyCzK2bvfixc8dC-qhfIANJginG-A7MOe1w',
  authDomain: 'dbwow-eb46c.firebaseapp.com',
  projectId: 'dbwow-eb46c',
  storageBucket: 'dbwow-eb46c.firebasestorage.app',
  messagingSenderId: '240027883917',
  appId: '1:240027883917:web:afea99bf81933ac2b345c4',
};
