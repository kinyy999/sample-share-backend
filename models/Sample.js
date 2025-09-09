const mongoose = require('mongoose');

//  סכימה פנימית לתגובה אחת
const commentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// סכימת Sample (דגימה מוזיקלית)
const sampleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  bpm: { type: Number, required: true },
  key: { type: String, required: true },
  genre: { type: String, required: true },
  url: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // metadata
  artist: { type: String, default: 'Unknown' },
  tags: { type: [String], default: [] },
  length: { type: Number, default: 0 },
  description: { type: String, default: '' },
  isPublic: { type: Boolean, default: true },

  // תגובות
  comments: [
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
],


}, { timestamps: true });

module.exports = mongoose.model('Sample', sampleSchema);
