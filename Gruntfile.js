module.exports = function(grunt) {
  const config = require('./.screeps.json')
  grunt.initConfig({
    eslint: {
      options: {
        configFile: '.eslintrc.yml',
      },
      target: ['src/**/*.js']
    },
    ts: {
      default: {
        tsconfig: './tsconfig.json'
      }
    },
    screeps: {
      options: {
        email: config.email,
        password: config.password,
        branch: config.branch,
        ptr: config.ptr
      },
      dist: {
        src: ['built/*.js']
      }
    }
  });

  grunt.loadNpmTasks('grunt-screeps');
  grunt.loadNpmTasks("grunt-ts");
  grunt.loadNpmTasks("grunt-eslint");

  grunt.registerTask("default", ["eslint", "ts"]);
  grunt.registerTask("screeps", ["default", "screeps"]);
}
