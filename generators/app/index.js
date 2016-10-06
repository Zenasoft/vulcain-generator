'use strict';
var yeoman = require('yeoman-generator');
var chalk = require('chalk');
var yosay = require('yosay');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var q = require('q');
var ejs = require('ejs');
var guid = require('guid');

module.exports = yeoman.Base.extend({

  constructor: function () {
    // Calling the super constructor is important so our generator is correctly set up
    yeoman.Base.apply(this, arguments);

    this.log(yosay('Welcome to ' + chalk.blue('VULCAIN') + ' generator'));

    this.answers = {};
  },


  loadTemplates: function () {
    return this.loadVulcainData('/api/template.all?kind=CodeGeneration');
  },

  loadServices: function () {
    return this.loadVulcainData('/api/service.all?cluster=test&withDiscoveryAddress=true');
  },
  loadVulcainData: function (path) {
    return new Promise((resolve, reject) => {
      if (!this.answers.vulcain) {
        reject('invalid vulcain config');
        return;
      }

      if (!path) {
        resolve();
        return;
      }

      var r = http.request({
        host: this.answers.vulcain.host,
        path: path,
        protocol: 'http:',
        method: 'GET',
        headers: {
          'Authorization': `ApiKey ${this.answers.vulcain.token}`
        }
      },
        res => {
          //console.log('STATUS: ' + res.statusCode);
          if (res.statusCode !== 200) {
            reject(res);
          }
          let data = '';
          res.on('data', (chunk) => data += chunk);

          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            }
            catch (err) {
              reject(err);
            }

          });
        });
      r.end();
    });
  },

  prompting: {
    selectVulcainProfile: function () {
      this.log('Vulcain Profile');

      var done = this.async();

      var homeDir = path.join(os.homedir(), '.vulcain');
      var filePath = path.join(homeDir, 'configs.json');

      if (!fs.existsSync(filePath)) {
        throw 'Vulcain is installed or not configured';
      }

      var vulcainConfig = JSON.parse(fs.readFileSync(filePath).toString());
      var choices = [];
      var selectedIndex = 0;
      var currIndex = 0;

      for (var p in vulcainConfig.data) {
        choices.push({ name: p, checked: p === vulcainConfig.defaultProfile });
        if (p === vulcainConfig.defaultProfile) {
          selectedIndex = currIndex;
        }
        currIndex++;
      }

      var prompts = [{
        name: 'vulcainProfile', type: 'rawlist', message: 'Select a Vulcain profile', choices: choices, default: selectedIndex
      }];

      this.prompt(prompts).then(answers => {
        this.answers.vulcain = {
          profile: answers.vulcainProfile,
          host: vulcainConfig.data[answers.vulcainProfile].server.slice(7),
          token: vulcainConfig.data[answers.vulcainProfile].token
        };
        done();
      });
    },

    selectTemplate: function () {
      this.log('Vulcain template selector');

      var done = this.async();

      this.loadTemplates().then(data => {
        this.templates = data.value;

        var prompts = [
          { name: 'serviceTemplate', type: 'list', message: 'Select a template', choices: data.value.map(t => { return { name: t.name, value: t }; }) }
        ];

        this.prompt(prompts).then(answers => {
          //this.log(JSON.stringify(answers, null, 2));

          this.answers.template = answers.serviceTemplate;

          //instanciate context to get remaining questions
          var ctxCode = this.answers.template.data.contextCode;
          if (!fs.existsSync(this.templatePath())) {
            fs.mkdir(this.templatePath());
          }
          var tempFilePath = this.templatePath(`${guid.raw()}.js`);
          fs.writeFileSync(tempFilePath, ctxCode);

          var Context = require(`${tempFilePath}`);
          //remove temp file
          fs.unlink(tempFilePath);

          this.answers.template.executingContext = new Context.Context();

          var contextPromptsBuilder = this.answers.template.executingContext.prompts().map(p => {
            return new Promise((resolve, reject) => {
              switch (p.lookup) {
                case 'service.all':
                  p.choices = [];
                  this.loadServices().then(
                    svcs => {
                      svcs.value.forEach(svc => {
                        svc.versions.forEach(v => {
                          p.choices.push({ name: `${svc.name}@${v.version}`, checked: false, value: v.discoveryAddress });
                        });
                      });
                    },
                    err => reject(err)
                  ).then(() => resolve(p));
                  break;
                default:
                  resolve(p);
              }
            });
          });

          q.all(contextPromptsBuilder).then(prompts => {
            this.prompt(prompts).then(ctxAnswers => {
              this.answers.template.initializationData = ctxAnswers;
              done();
            });
          });

        });
      });
    }

  },

  writing: function () {
    var self = this;
    var done = this.async();
    this.log('Writing');
    this.log(JSON.stringify(this.answers.template.initializationData));
    this.answers.template.executingContext.init(this.answers.template.initializationData).then((outFilePath) => {
      // try {
        var out = ejs.render(
          self.answers.template.data.templateCode,
          self.answers.template.executingContext
        );

        self.fs.write(
          self.destinationPath(outFilePath),
          out
        );

        done();
    });



  },

  install: function () {
    // this.installDependencies();
  }
});
