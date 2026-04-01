# RepasParle

Application web (GitHub Pages) pour cours de FLE:
- Vue élève (smartphone): choix du nom, nom du repas, photo(s) + audio(s), barre de progression, suppression, zoom image, modification d'un repas déjà envoyé, modification d'une évaluation déjà envoyée, évaluations à faire/reçues, affichage des retours prof.
- Vue gestion (ordinateur): gestion complète (ajout/suppression élèves, repas, évaluations), attribution d'évaluations, retours prof sur repas/évaluations, export ZIP avec CSV global + CSV d'évaluations par élève dans chaque dossier.

## Fichiers

- `index.html`: accueil
- `eleve.html`: interface élève
- `gestion.html`: interface enseignante
- `css/style.css`: styles communs
- `js/firebase-config.js`: configuration Firebase à compléter
- `js/firebase-service.js`: accès Firestore + Storage
- `js/student.js`: logique vue élève
- `js/teacher.js`: logique vue gestion

## Configuration Firebase

1. Créer un projet Firebase.
2. Activer `Firestore Database` et `Storage`.
3. Créer une application Web et récupérer la config.
4. Remplir `js/firebase-config.js`.
5. Héberger le dossier sur GitHub Pages.

## Règles Firestore (usage personnel)

> Attention: ces règles sont volontairement ouvertes (pas d'authentification).

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

## Règles Storage (usage personnel)

```txt
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

## CORS Storage (obligatoire pour export ZIP dans le navigateur)

Si l'export affiche des erreurs `Access-Control-Allow-Origin` dans la console, il faut configurer CORS sur le bucket.

1. Se connecter:
`gcloud auth login`

2. Appliquer la config CORS:
`gsutil cors set firebase-storage-cors.json gs://mesrepas-94ee8.firebasestorage.app`

3. Vérifier:
`gsutil cors get gs://mesrepas-94ee8.firebasestorage.app`

Quand l'app sera sur GitHub Pages, ajoute aussi ton domaine `https://<utilisateur>.github.io` dans `firebase-storage-cors.json`, puis réapplique la commande.

## Structure des données

### `students/{studentId}`
- `name`
- `lowerName`
- `createdAt`
- `createdAtMs`

### `meals/{mealId}`
- `studentId`
- `studentName`
- `mealLabel` (nom du repas)
- `teacherMealFeedback` (`teacherFeedback` conservé pour compatibilité)
- `createdAt`
- `createdAtMs`
- `photos[]`: `{ path, url, name, size, mimeType }`
- `audios[]`: `{ path, url, name, size, mimeType }`

### `evaluations/{evaluationId}`
- `evaluatorId`, `evaluatorName`
- `targetStudentId`, `targetStudentName`
- `targetMealId`, `targetMealLabel`, `targetMealDateMs`
- `targetMealMedia`
- `criteria[]`: `{ id, text }`
- `status`: `pending` ou `done`
- `response.answers[]`: `{ criterionId, criterionText, text }`
- `teacherEvaluationFeedback` (`teacherFeedback` conservé pour compatibilité)

## Anonymisation vocale locale

- Les audios enregistres depuis `eleve.html` sont modifies localement dans le navigateur avant d'etre ajoutes au brouillon puis envoyes vers Firebase.
- Le traitement applique un decalage de hauteur, un filtrage de timbre, une compression et un tres leger bruit de masquage, puis reencode le resultat en `audio/wav` mono.
- Si le navigateur ne sait pas faire ce traitement localement, le bouton d'enregistrement audio est desactive pour eviter l'envoi de la voix brute.
- Cette mesure reduit fortement l'identifiabilite de la voix, mais ne constitue pas a elle seule une garantie juridique d'anonymisation irreversible. Pour un cadrage conforme a vos obligations, il faut valider le dispositif avec votre service de protection des donnees.

## Nom proposé

Nom d'app proposé: **RepasParle**
