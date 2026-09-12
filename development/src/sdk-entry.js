import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import * as firestore from 'firebase/firestore';
import {getApp} from 'firebase/app';
import {databaseFactory} from './db.cjs';
window.firebase=firebase;
window.ShopFirestore=databaseFactory(firestore,getApp);
