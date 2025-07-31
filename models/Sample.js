const mongoose = require('mongoose');

// נגדיר את המבנה של sample
const sampleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  bpm: {
    type: Number,
    required: true
  },
  key: {
    type: String,
    required: true
  },
  genre: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  }
});

// ניצור מודל ונייצא אותו
module.exports = mongoose.model('Sample', sampleSchema);
