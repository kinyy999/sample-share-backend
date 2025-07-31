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
const authenticateToken = require('./middlewares/auth');


// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB Atlas'))
.catch((err) => console.error('❌ MongoDB connection error:', err));

// Middleware
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.send('✅ SampleShare backend is working!');
});

app.post('/samples', async (req, res) => {
  try {
    const sample = new Sample({
      title: req.body.title,
      bpm: req.body.bpm,
      key: req.body.key,
      genre: req.body.genre,
      url: req.body.url
    });

    const savedSample = await sample.save();
    res.status(201).json(savedSample);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.get('/samples', authenticateToken, async (req, res) => {
  try {
    const samples = await Sample.find(); // שולף את כל הסאמפלים
    res.json(samples); // מחזיר את כולם כ־JSON
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/samples/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updatedSample = await Sample.findByIdAndUpdate(
      id,
      {
        title: req.body.title,
        bpm: req.body.bpm,
        key: req.body.key,
        genre: req.body.genre,
        url: req.body.url,
      },
      { new: true } // מחזיר את המסמך החדש אחרי העדכון
    );

    if (!updatedSample) {
      return res.status(404).json({ error: 'Sample not found' });
    }

    res.json(updatedSample);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.delete('/samples/:id', async (req, res) => {
  try {
    const deletedSample = await Sample.findByIdAndDelete(req.params.id);

    if (!deletedSample) {
      return res.status(404).json({ error: 'Sample not found' });
    }

    res.json({ message: 'Sample deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    // השוואת סיסמאות
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // יצירת טוקן
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
