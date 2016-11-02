'use strict';

var gulp = require('gulp');
var jasmine = require('gulp-jasmine');
var istanbul = require('gulp-istanbul');
var sourcemaps = require('gulp-sourcemaps');
var remapIstanbul = require('remap-istanbul/lib/gulpRemapIstanbul');

var sources = ['./src/**/*.ts'];

function executeTypescriptCompiler(options) {
  options = options || {};
  options.project = options.project || process.cwd();
  var command = makeTscCommandString(options);
  return function (done) {
    require('child_process').exec(command, function (err, stdout, stderr) {
      var outString = stdout.toString();
      if (outString) console.log('\n', outString);
      if (options.taskAlwaysSucceed) {
        return done();
      }
      done(err);
    });
  };
}

function makeTscCommandString(options) {
  return 'tsc ' +
    Object.keys(options)
      .filter(function (key) {
        return key !== 'taskAlwaysSucceed';
      })
      .map(function (key) {
        return '--' + key + ' ' + (options[key] || '');
      })
      .join(' ');
}

function watch() {
  gulp.watch(sources, {interval: 2000}, ['buildIgnoreError']);
}

function clean(done) {
  var del = require('del');
  del(['./dist', './node_modules', './coverage'], done);
}

function registerJasmineTasks() {
  var files = require('glob').sync('./dist/spec/*.js');
  files.forEach(function (name) {
    // ./dist/spec/abc.spec.js => abc.spec
    var taskName = name.match(/^.*\/(.*)\.js$/)[1];
    jasmineTask(taskName);
  });
}

function jasmineTask(name) {
  var buildAndTest = 'run-' + name;
  gulp.task(name, [buildAndTest], function () {
    // gulp.watch(sources, [buildAndTest]);
  });
  gulp.task(buildAndTest, ['build'], function () {
    return gulp.src('./dist/spec/' + name + '.js')
      .pipe(jasmine());
  });
}

function preIstanbulTask() {
  return gulp.src(['dist/**/*.js'])
    .pipe(istanbul())
    .pipe(istanbul.hookRequire());
}
function istanbulTask() {
  const stream = gulp.src(['dist/spec/*.js']).pipe(jasmine());
  // https://github.com/gulpjs/gulp/issues/358 or gulp-plumber
  stream.on('error', (e) => {
    process.exit(1);
  });
  return stream.pipe(istanbul.writeReports());
}
function remapIstanbulTask() {
  return gulp.src('coverage/coverage-final.json')
    .pipe(remapIstanbul({
      reports: {
        html: 'coverage/remap-report',
        'lcovonly': 'coverage/lcov-remap.info'
      }
    }));
}

gulp.task('build', executeTypescriptCompiler());
gulp.task('buildIgnoreError', executeTypescriptCompiler({noEmitOnError: '', taskAlwaysSucceed: true}));
gulp.task('watch', watch);
gulp.task('clean', clean);
gulp.task('pre-coverage', ['build'], preIstanbulTask);
gulp.task('coverage-js', ['pre-coverage'], istanbulTask);
gulp.task('coverage', ['coverage-js'], remapIstanbulTask);
registerJasmineTasks();
