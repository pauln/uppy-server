var EventEmitter = require('events')
var fs = require('fs')
var http = require('http')
var path = require('path')
var tus = require('tus-js-client')
var generateUUID = require('../utils/generateUUID')

function Uploader (options) {
  var uploader = Object.create(Uploader.prototype)
  EventEmitter.call(uploader)
  uploader.options = options
  return uploader
}

Uploader.prototype = Object.create(EventEmitter.prototype)

Uploader.prototype.upload = function (options) {
  var fpath = options.path
  var fname = options.name || path.basename(fpath)

  var writer = fs.createWriteStream(fpath)

  writer.on('finish', () => {
    if (!this.options.endpoint) {
      return this.emit('finish', {
        body: 'no endpoint',
        status: 200,
        statusText: 'File written to uppy server local storage'
      })
    }

    if (this.options.protocol === 'tus') {
      var token = generateUUID()

      var file = fs.createReadStream(fpath)
      var size = fs.statSync(fpath).size

      var upload = new tus.Upload(file, {
        endpoint: this.options.endpoint,
        resume: true,
        metadata: {
          filename: fname
        },
        uploadSize: size,
        onError: function (error) {
          throw error
        },
        onProgress: function (bytesUploaded, bytesTotal) {
          var percentage = (bytesUploaded / bytesTotal * 100).toFixed(2)
          console.log(bytesUploaded, bytesTotal, percentage + '%')

          var emitData = JSON.stringify({
            action: 'progress',
            payload: {
              progress: percentage,
              bytesUploaded: bytesUploaded,
              bytesTotal: bytesTotal
            }
          })

          emitter.on('connection:' + token, function () {
            emitter.emit(token, emitData)
          })

          emitter.emit(token, emitData)
        },
        onSuccess: function () {
          console.log('Upload finished:', upload.url)
          emitter.emit(token, JSON.stringify({
            action: 'progress',
            payload: {
              complete: true
            }
          }))
        }
      })

      upload.start()

      return this.emit('finish', {
        body: {
          token
        },
        status: 200
      })
    }

    fs.readFile(fpath, (err, data) => {
      if (err) {
        return this.emit('finish', {
          body: err
        })
      }

      var req = http.request({
        host: 'api2.transloadit.com',
        method: 'POST',
        'Content-Type': 'multipart/form-data',
        'Content-Length': data.length
      }, (res) => {
        // console.log('STATUS:', res.statusCode)
        // console.log('HEADERS:', JSON.stringify(res.headers, null, '\t'))

        res.on('data', (chunk) => {
          // console.log('BODY:', chunk)
        })

        res.on('end', () => {
          var status

          if (res.status) {
            status = res.status
          }

          if (res.statusCode < 200 || res.statusCode > 300) {
            // Server logging
            console.log('Status Code was not between 200-300.  There was an error: ')
            console.log('response status code:', res.statusCode)
            console.log('response status:')
            console.log(res.status)

            return this.emit('finish', {
              status: res.statusCode,
              statusText: 'error',
              body: 'no bueno'
            })
          }

          if (res.statusCode >= 200 && res.statusCode <= 300) {
            // Server logging
            console.log('Transfer to server `' + this.options.endpoint + '` was successful.')
            console.log('Status code: ', res.statusCode)

            status = res.statusCode
            return this.emit('finish', {
              status: status,
              body: 'good job'
            })
          }
        })
      })

      req.on('error', (error) => {
        console.log('problem with request: ' + error.message)
        this.emit('finish', {
          status: 500,
          body: error
        })
      })

      req.write(data)
      req.end()
    })
  })

  return writer
}

exports = module.exports = Uploader
