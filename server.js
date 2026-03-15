// server.js
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 3000;
const Sample = require('./models/Sample');
const User = require('./models/User'); // נייבא את מודל המשתמש
const bcrypt = require('bcrypt'); // להצפנת סיסמאות
const jwt = require('jsonwebtoken'); // להפקת טוקן JWT
const { authenticateToken, isAdmin } = require('./middlewares/auth');

const multer = require("multer");
const path = require("path");



// איפה לשמור את הקבצים
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
});

// רק סוגי אודיו מותרים
const audioTypes = /audio\/(mpeg|mp3|wav|x-wav|ogg|aac)/i;

// הגדרות העלאה
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // עד 10MB
  fileFilter: (req, file, cb) => {
    if (audioTypes.test(file.mimetype)) return cb(null, true);
    cb(new Error("Only audio files are allowed"));
  },
});

module.exports = upload;


const uploadsDir = path.join(__dirname, 'uploads');

app.use(
  '/uploads',
  (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(uploadsDir)
);

app.get('/download/:id', async (req, res) => {
  try {
    const sample = await Sample.findById(req.params.id).lean();
    if (!sample || !sample.audio) return res.status(404).json({ error: 'file not found' });

    const filePath = path.join(uploadsDir, sample.audio);
    const niceName =
      (sample.title ? sample.title.replace(/[^\w.-]+/g, '_') : 'sample') + path.extname(filePath);

    res.header('Access-Control-Allow-Origin', '*');
    res.download(filePath, niceName);           // ← מכריח הורדה (attachment)
  } catch (e) {
    res.status(500).json({ error: 'download failed' });
  }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('✅ Connected to MongoDB Atlas'))
.catch((err) => console.error('❌ MongoDB connection error:', err));

// Middleware
app.use(express.json());
const cors = require('cors');

app.use(cors({
  origin: [
    'http://localhost:3001',
    'https://sample-share-frontend2-lbc8-nnhagltjx-kiny.vercel.app',
  ],
}));

// Routes
app.get('/', (req, res) => {
  res.send('✅ SampleShare backend is working!');
});

// החלפה מלאה של הראוט הקיים:
app.post('/samples', authenticateToken, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'audio file is required' });

    const sample = new Sample({
      title: req.body.title,
      bpm: req.body.bpm,
      key: req.body.key,
      genre: req.body.genre,
      url: req.body.url,
      artist: req.body.artist,
      description: req.body.description,
      isPublic: req.body.isPublic === 'true',
      audio: req.file.filename,          // ← שם קובץ האודיו שנשמר ב-uploads/
      owner: req.user.userId,            // מותאם למה שיש אצלך במידלוור
    });

    const savedSample = await sample.save();
    res.status(201).json(savedSample);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/samples', async (req, res) => {
  try {
    const { bpm, genre, key, artist, isPublic, page = '1', limit = '20' } = req.query;
    const query = {};

    if (bpm !== undefined) query.bpm = Number(bpm);
    if (genre)  query.genre  = new RegExp(`^${genre}$`, 'i');
    if (key)    query.key    = new RegExp(`^${key}$`, 'i');
    if (artist) query.artist = new RegExp(artist, 'i');
    if (isPublic !== undefined) query.isPublic = isPublic === 'true';

    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (p - 1) * l;

    const [items, total] = await Promise.all([
      Sample.find(query).sort({ createdAt: -1 }).skip(skip).limit(l),
      Sample.countDocuments(query)
    ]);

    res.json({
      page: p,
      limit: l,
      total,
      pages: Math.ceil(total / l),
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /samples/:id – שליפת פריט יחיד (כולל תגובות עם שם/אימייל הכותב)
app.get('/samples/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'invalid sample id' });
    }

    const sample = await Sample
      .findById(id)
      .populate('comments.user', 'username email');

    if (!sample) {
      return res.status(404).json({ error: 'Sample not found' });
    }

    return res.json(sample);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// עדכון דגימה – בעלים/אדמין, תומך גם בהעלאת אודיו אופציונלית
app.put('/samples/:id', authenticateToken, upload.single('audio'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'invalid sample id' });
    }

    // שליפה כדי לבדוק הרשאות
    const sample = await Sample.findById(id);
    if (!sample) {
      return res.status(404).json({ error: 'Sample not found' });
    }

    const isOwner = sample.owner && sample.owner.toString() === req.user.userId;
    const isAdminRole = req.user.role === 'admin';
    if (!isOwner && !isAdminRole) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // עדכון שדות טקסטואליים (מה-FormData או JSON)
    const body = req.body || {};
    const updatable = ['title','bpm','key','genre','url','artist','tags','length','description','isPublic'];
    for (const k of updatable) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        // המרות קלות
        if (k === 'bpm') sample[k] = body[k] ? Number(body[k]) : undefined;
        else if (k === 'isPublic') sample[k] = body[k] === 'true' || body[k] === true;
        else sample[k] = body[k];
      }
    }

    // אם עלו קובץ אודיו חדש – נחליף
    if (req.file && req.file.filename) {
      sample.audio = req.file.filename; // נשמר ב־uploads/
    }

    const updated = await sample.save();
    return res.json(updated);

  } catch (err) {
    // שגיאת ולידציה/אחרות
    return res.status(400).json({ error: err.message });
  }
});





// PUT /samples/:sampleId/comments/:commentId – עדכון טקסט של תגובה קיימת (Owner-only)
app.put('/samples/:sampleId/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const { sampleId, commentId } = req.params;
    const { text } = req.body || {};

    if (!mongoose.isValidObjectId(sampleId) || !mongoose.isValidObjectId(commentId)) {
      return res.status(400).json({ error: 'invalid id' });
    }
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const sample = await Sample.findById(sampleId);
    if (!sample) return res.status(404).json({ error: 'Sample not found' });

    const comment = sample.comments.id(commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (comment.user.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    comment.text = text.trim();
    await sample.save();

    res.json({ message: 'Comment updated', comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// DELETE /samples/:id — מותר לבעל ה-Sample או לאדמין
app.delete('/samples/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // ולידציית מזהה
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'invalid sample id' });
    }

    // שליפה כדי לבדוק בעלות
    const sample = await Sample.findById(id);
    if (!sample) {
      return res.status(404).json({ error: 'Sample not found' });
    }

    // הרשאות: בעלים או אדמין
    const isOwner = sample.owner && sample.owner.toString() === req.user.userId;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // מחיקה
    await sample.deleteOne();
    return res.json({ message: 'Sample deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// DELETE /samples/:sampleId/comments/:commentId – מחיקה של תגובה קיימת
app.delete('/samples/:sampleId/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const { sampleId, commentId } = req.params;

    if (!mongoose.isValidObjectId(sampleId) || !mongoose.isValidObjectId(commentId)) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const sample = await Sample.findById(sampleId);
    if (!sample) return res.status(404).json({ error: 'Sample not found' });

    const comment = sample.comments.id(commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    // הרשאה: רק בעל התגובה (אותו userId מה־JWT שלך)
    if (comment.user.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }

    comment.deleteOne();            // מסיר את התגובה מהמערך
    await sample.save();            // שומר את הדגימה המעודכנת

    return res.json({ message: 'Comment deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// Register route
app.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // האם המשתמש כבר קיים?
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // הצפנת סיסמה
    const hashedPassword = await bcrypt.hash(password, 10);

    // יצירת משתמש חדש
    const newUser = new User({ username, email, password: hashedPassword });
    const savedUser = await newUser.save();

    res.status(201).json(savedUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Login route
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // חיפוש משתמש לפי אימייל
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // ✅ חדש: בדיקה אם המשתמש נעול
    if (!user.isActive) {
      return res.status(403).json({ error: 'User account is deactivated' });
    }

    // השוואת סיסמאות
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // יצירת טוקן - כולל גם role
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // החזרת הטוקן וגם ה-role
    res.json({ token, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  הוספת תגובה ל־Sample לפי ID
app.post('/samples/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    const sample = await Sample.findById(id);
    if (!sample) return res.status(404).json({ error: 'Sample not found' });

    sample.comments.push({
      user: req.user.userId,
      text: text,
      createdAt: new Date(),
    });



    await sample.save({ validateModifiedOnly: true });

    //  ממלאים את מחברי התגובות לפני שמחזירים
    await sample.populate({ path: 'comments.user', select: 'username email' });

    return res.status(201).json({ message: 'Comment added successfully', sample });
  } catch (err) {
    return res.status(500).json({ message: 'Error adding comment', error: err.message });
  }
});



// GET /users – רק אדמין
app.get('/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password'); // לא מחזירים סיסמאות
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /users/:id — מחיקת משתמש (Admin-only)
app.delete('/users/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'invalid user id' });
    }

    // הגנה: לא מאפשרים לאדמין למחוק את עצמו בטעות
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'admin cannot delete self' });
    }

    const deleted = await User.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: 'User not found' });

    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /users/:id/role — שינוי role ע"י אדמין בלבד
app.patch('/users/:id/role', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // ולידציית מזהה
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'invalid user id' });
    }

    // ולידציה לערך role
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'role must be user or admin' });
    }

    // עדכון role
    const updated = await User.findByIdAndUpdate(id, { role }, { new: true }).select('-password');
    if (!updated) return res.status(404).json({ error: 'User not found' });

    res.json({ message: 'Role updated successfully', user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /users/:id/active — שינוי סטטוס חשבון (נעילה/פתיחה) ע"י אדמין
app.patch('/users/:id/active', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'invalid user id' });
    }

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be true or false' });
    }

    const updated = await User.findByIdAndUpdate(id, { isActive }, { new: true }).select('-password');
    if (!updated) return res.status(404).json({ error: 'User not found' });

    res.json({ message: `User ${isActive ? 'activated' : 'deactivated'} successfully`, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
