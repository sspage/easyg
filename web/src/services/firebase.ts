import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDroYaXqCldo5779RpMrbDeyqwRR-LrGBY",
  authDomain: "white-dispatch-481617-f8.firebaseapp.com",
  projectId: "white-dispatch-481617-f8",
  storageBucket: "white-dispatch-481617-f8.firebasestorage.app",
  messagingSenderId: "909964402298",
  appId: "1:909964402298:web:e107bbdd9b060df47265c3",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
export default app;
