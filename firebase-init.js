import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase, ref, get, update, set } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { config } from "./config.js";

const app = initializeApp(config.FIREBASE);
const database = getDatabase(app);
const auth = getAuth(app);
const db = getFirestore(app);

// 필요한 함수들을 객체로 묶어서 내보내거나 개별 export
export { 
    app, database, auth, db, 
    ref, get, update, set, 
    onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup,
    doc, getDoc, setDoc, updateDoc, writeBatch 
};