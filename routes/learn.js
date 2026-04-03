const express = require('express');
const router = express.Router();
const db = require('../database/init');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

router.get('/courses', optionalAuth, (req, res) => {
  const courses = db.prepare("SELECT c.*, (SELECT COUNT(*) FROM lessons WHERE course_id = c.id) as lesson_count FROM courses c WHERE c.is_published = 1 ORDER BY c.sort_order").all();
  if (req.user) {
    const enriched = courses.map(c => {
      const completed = db.prepare("SELECT COUNT(*) as n FROM user_progress up JOIN lessons l ON up.lesson_id = l.id WHERE l.course_id = ? AND up.user_id = ? AND up.completed = 1").get(c.id, req.user.id).n;
      return { ...c, completedLessons: completed, progress: c.lesson_count > 0 ? Math.round((completed / c.lesson_count) * 100) : 0 };
    });
    return res.json(enriched);
  }
  res.json(courses);
});

router.get('/courses/:id', optionalAuth, (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id = ? AND is_published = 1').get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Corso non trovato' });
  const lessons = db.prepare('SELECT id, course_id, title, sort_order, type FROM lessons WHERE course_id = ? ORDER BY sort_order').all(req.params.id);
  if (req.user) {
    const progress = db.prepare('SELECT lesson_id, completed, score FROM user_progress WHERE user_id = ?').all(req.user.id);
    const pmap = {};
    progress.forEach(p => { pmap[p.lesson_id] = p; });
    return res.json({ ...course, lessons: lessons.map(l => ({ ...l, progress: pmap[l.id] || null })) });
  }
  res.json({ ...course, lessons });
});

router.get('/lessons/:id', authenticateToken, (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lezione non trovata' });
  const progress = db.prepare('SELECT * FROM user_progress WHERE user_id = ? AND lesson_id = ?').get(req.user.id, req.params.id);
  res.json({ ...lesson, quizData: lesson.quiz_data ? JSON.parse(lesson.quiz_data) : null, progress });
});

router.post('/lessons/:id/complete', authenticateToken, (req, res) => {
  const { score } = req.body;
  const lesson = db.prepare('SELECT id FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lezione non trovata' });
  db.prepare("INSERT INTO user_progress (user_id, lesson_id, completed, score, completed_at) VALUES (?, ?, 1, ?, datetime('now')) ON CONFLICT(user_id, lesson_id) DO UPDATE SET completed = 1, score = ?, completed_at = datetime('now')").run(req.user.id, req.params.id, score || null, score || null);
  res.json({ success: true });
});

router.get('/progress', authenticateToken, (req, res) => {
  const progress = db.prepare("SELECT up.*, l.title as lesson_title, l.type, c.title as course_title, c.icon as course_icon FROM user_progress up JOIN lessons l ON up.lesson_id = l.id JOIN courses c ON l.course_id = c.id WHERE up.user_id = ? ORDER BY up.completed_at DESC").all(req.user.id);
  const totalLessons = db.prepare('SELECT COUNT(*) as n FROM lessons').get().n;
  const completed = progress.filter(p => p.completed).length;
  res.json({ progress, totalLessons, completed, percentage: totalLessons > 0 ? Math.round((completed / totalLessons) * 100) : 0 });
});

module.exports = router;
